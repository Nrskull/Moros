export interface ChronicleEntry {
  id: string
  label: string
  note: string
  year: number
}

export interface CharacterAgeProfile {
  id: string
  anchorAge: number
  anchorYear: number
  color: string
  name: string
}

export const sampleChronicleEntries: ChronicleEntry[] = [
  {
    id: 'chronicle_177',
    label: '负层纪年 177',
    note: '旧城局势刚刚开始失衡，角色关系仍处在彼此试探的阶段。',
    year: 177,
  },
  {
    id: 'chronicle_180',
    label: '负层纪年 180',
    note: '关键人物正式汇流，适合对照不同角色在同一节点的年龄与位置。',
    year: 180,
  },
  {
    id: 'chronicle_184',
    label: '负层纪年 184',
    note: '作为后续节点，用来验证自定义编年扩展后年龄是否持续自动推算。',
    year: 184,
  },
]

export const sampleCharacterProfiles: CharacterAgeProfile[] = [
  {
    id: 'char_liuzhizhou',
    name: '柳之舟',
    anchorYear: 177,
    anchorAge: 14,
    color: '#a46245',
  },
  {
    id: 'char_liuzhiqing',
    name: '柳之清',
    anchorYear: 177,
    anchorAge: 10,
    color: '#4d7b95',
  },
  {
    id: 'char_yaoguang',
    name: '爻光',
    anchorYear: 180,
    anchorAge: 14,
    color: '#7c6497',
  },
]

export function calculateCharacterAge(year: number, profile: CharacterAgeProfile): number {
  return profile.anchorAge + (year - profile.anchorYear)
}

export function formatCharacterAge(age: number): string {
  if (age < 0) {
    return '未出生'
  }

  return `${age} 岁`
}
